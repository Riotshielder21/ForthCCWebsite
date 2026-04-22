import React, { useState } from 'react';
import { Plus, X, Send, CheckCircle, AlertCircle } from 'lucide-react';

const LIST_TYPES = [
  'Equipment Needed',
  'Volunteer Sign-ups',
  'Event Participants',
  'Maintenance Tasks',
  'Other'
];

export default function ListSubmissionForm() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    listType: '',
    items: [''],
    notes: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleItemChange = (index, value) => {
    const newItems = [...formData.items];
    newItems[index] = value;
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  const addItem = () => {
    setFormData(prev => ({ ...prev, items: [...prev.items, ''] }));
  };

  const removeItem = (index) => {
    if (formData.items.length > 1) {
      const newItems = formData.items.filter((_, i) => i !== index);
      setFormData(prev => ({ ...prev, items: newItems }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      // Filter out empty items
      const filteredItems = formData.items.filter(item => item.trim() !== '');

      if (filteredItems.length === 0) {
        throw new Error('Please add at least one item to your list');
      }

      const response = await fetch('/api/lists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          items: filteredItems
        }),
      });

      const result = await response.json();

      if (response.ok) {
        let message = 'List submitted successfully!';
        
        // Handle volunteer verification and discount code
        if (formData.listType === 'Volunteer Sign-ups') {
          if (result.verification?.verified) {
            message = `Thank you for volunteering! Your discount code is: ${result.discountCode}`;
          } else {
            message = 'List submitted successfully! Note: Your name was not found in our member database. Please contact us if you believe this is an error.';
          }
        }

        setSubmitStatus({ 
          type: 'success', 
          message,
          discountCode: result.discountCode,
          verified: result.verification?.verified
        });
        
        // Reset form
        setFormData({
          name: '',
          email: '',
          listType: '',
          items: [''],
          notes: ''
        });
      } else {
        throw new Error(result.error || 'Failed to submit list');
      }
    } catch (error) {
      setSubmitStatus({ type: 'error', message: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="FormContainer">
      <div className="SpaceB8">
        <h2 className="FormTitle">
          Submit a Form request
        </h2>
        <p className="FormDescription">
          Book out equipment, become a volunteers.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="FormBody">
        {/* Basic Info */}
        <div className="FormFieldGrid">
          <div>
            <label className="FormLabel">
              Your Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              className="FormInput"
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="FormLabel">
              Email Address *
            </label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              className="FormInput"
              placeholder="john@example.com"
            />
          </div>
        </div>

        {/* List Type */}
        <div>
          <label className="FormLabel">
            List Type *
          </label>
          <select
            required
            value={formData.listType}
            onChange={(e) => handleInputChange('listType', e.target.value)}
            className="FormInput"
          >
            <option value="">Select required form...</option>
            {LIST_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        {/* List Items */}
        <div>
          <label className="FormLabel">
            List Items *
          </label>
          <div className="FormItemList">
            {formData.items.map((item, index) => (
              <div key={index} className="FormItemRow">
                <input
                  type="text"
                  value={item}
                  onChange={(e) => handleItemChange(index, e.target.value)}
                  className="FormInputFlex FormInput"
                  placeholder={`Item ${index + 1}`}
                />
                {formData.items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="FormRemoveButton"
                  >
                    <X className="IconLg" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addItem}
            className="FormAddButton"
          >
            <Plus className="IconMd" />
            Add Another Item
          </button>
        </div>

        {/* Notes */}
        <div>
          <label className="FormLabel">
            Additional Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => handleInputChange('notes', e.target.value)}
            rows={3}
            className="FormInput"
            placeholder="Any additional information..."
          />
        </div>

        {/* Submit Status */}
        {submitStatus && (
          <div className={`FormAlert ${
            submitStatus.type === 'success'
              ? 'AlertSuccess'
              : 'AlertError'
          }`}>
            <div className="FormAlertInner">
              {submitStatus.type === 'success' ? (
                <CheckCircle className="IconLg FormAlertIcon" />
              ) : (
                <AlertCircle className="IconLg FormAlertIcon" />
              )}
              <div className="FormAlertBody">
                <p className="FormAlertMessage">{submitStatus.message}</p>
                {submitStatus.discountCode && (
                  <div className="DiscountCodeBox">
                    <p className="DiscountCodeTitle">
                      Your Discount Code
                    </p>
                    <p className="DiscountCodeValue">
                      {submitStatus.discountCode}
                    </p>
                    <p className="DiscountCodeHint">
                      Use this code at checkout for 25% off your next purchase
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="FormSubmitButton"
        >
          {isSubmitting ? (
            <>
              <div className="FormSpinner" />
              Submitting...
            </>
          ) : (
            <>
              <Send className="IconMd" />
              Submit List
            </>
          )}
        </button>
      </form>
    </div>
  );
}